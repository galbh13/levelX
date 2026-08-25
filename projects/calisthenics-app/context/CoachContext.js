import React, { createContext, useContext, useState } from 'react';

const CoachContext = createContext();

// `isAdmin` marks the COACH-side provider (AdminNavigator). Screens shared by
// both roles — WorkoutsScreen, StudentDetailScreen — read it to hide coach-only
// tools (e.g. WORKOUTS LIBRARY) from players.
export function CoachProvider({ children, isAdmin = false }) {
  const [selectedStudent,  setSelectedStudent]  = useState(null);
  const [selectedDay,      setSelectedDay]      = useState(null);
  const [pendingExercises, setPendingExercises] = useState([]);

  const addExercise = (exercise) => {
    setPendingExercises(prev => [...prev, {
      ...exercise,
      // Stable uid so exerciseDetails keys survive reordering
      _uid:   `${exercise.id}_${Date.now()}_${prev.length}`,
      letter: String.fromCharCode(65 + prev.length),
    }]);
  };

  const removeExercise = (index) => {
    setPendingExercises(prev => {
      const next = prev.filter((_, i) => i !== index);
      // Re-assign letters after removal
      return next.map((ex, i) => ({ ...ex, letter: String.fromCharCode(65 + i) }));
    });
  };

  const clearExercises = () => setPendingExercises([]);

  return (
    <CoachContext.Provider value={{
      isAdmin,
      selectedStudent, setSelectedStudent,
      selectedDay,     setSelectedDay,
      pendingExercises,
      addExercise,
      removeExercise,
      clearExercises,
    }}>
      {children}
    </CoachContext.Provider>
  );
}

export function useCoach() {
  return useContext(CoachContext);
}
