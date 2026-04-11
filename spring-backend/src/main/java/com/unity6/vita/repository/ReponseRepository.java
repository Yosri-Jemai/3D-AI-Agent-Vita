package com.unity6.vita.repository;

import com.unity6.vita.entity.Evaluation;
import com.unity6.vita.entity.Reponse;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReponseRepository extends JpaRepository<Reponse, Long> {
    List<Reponse> findByEvaluation(Evaluation evaluation);
    List<Reponse> findByEvaluationAndCorrecte(Evaluation evaluation, Boolean correcte);
}